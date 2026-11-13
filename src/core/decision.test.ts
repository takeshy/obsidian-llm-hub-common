import { describe, expect, it, vi } from "vitest";
import { parseDecisionDefinition, requestDecision, type DecisionDefinition } from "./decision.js";
const score: DecisionDefinition = { type: "score", criteria: ["None", "Low", "Useful", "Direct"] };
const choice: DecisionDefinition = { type: "choice", criteria: { urgent: "Needs action now", normal: "Can wait", ignore: "Not a request" } };
const response = (answer: unknown) => new Response(JSON.stringify({ answers: { decision: answer } }));

describe("Score and Choice Decisions API", () => {
  it.each(["gemini", "jev", "openrouter"] as const)("sends ordered score criteria and named choices to %s", async provider => {
    for (const [definition, answer, expected] of [[score, { type: "score", score: 2.7, confidence: 0 }, 2.7], [choice, { type: "choice", choice: "normal", confidence: 0 }, "normal"]] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response(answer));
      expect(await requestDecision("Evaluate", "Evidence", { provider, apiKey: "key", fetchImpl: request }, definition)).toBe(expected);
      const body = JSON.parse(String(request.mock.calls[0][1]?.body));
      expect(body.questions.decision).toMatchObject({ type: definition.type, criteria: definition.criteria });
      expect(body.model).toBe(provider === "gemini" ? "gemini-decision-1" : provider === "jev" ? "jev-latest" : "~typesafe/jev-latest");
    }
  });
  it.each([
    [score, { type: "score", score: "2" }], [score, { type: "score", score: -0.1 }],
    [score, { type: "score", score: 3.1 }], [score, { type: "score" }],
    [score, { type: "choice", score: 2 }], [choice, { type: "choice", choice: "missing" }],
    [choice, { type: "choice", choice: 0 }], [choice, { type: "score", choice: "urgent" }],
    [choice, { type: "choice", choice: "toString" }], [choice, null],
  ] as [DecisionDefinition, unknown][])("rejects invalid answers instead of producing a route (%j)", async (definition, answer) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(answer));
    await expect(requestDecision("Evaluate", "Input", { provider: "gemini", apiKey: "key", fetchImpl: request }, definition)).rejects.toThrow("invalid or incomplete");
  });
  it.each([
    ["invalid", []], ["score", []], ["score", ["Only"]], ["score", ["Low", " "]], ["score", ["Low", 2]],
    ["choice", {}], ["choice", ["a", "b"]], ["choice", { a: "First" }],
    ["choice", { a: "First", b: "" }], ["choice", { a: "First", " b": "Second" }],
  ])("rejects malformed criteria before requesting (%s %j)", (type, criteria) => {
    expect(() => parseDecisionDefinition(type as string, criteria)).toThrow();
  });
  it("supports choice names that resemble object members and boolean values", async () => {
    const definition = parseDecisionDefinition("choice", JSON.parse('{"__proto__":"Option A","false":"Option B"}'));
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ type: "choice", choice: "__proto__" }));
    expect(await requestDecision("Evaluate", "Input", { provider: "jev", apiKey: "key", fetchImpl: request }, definition)).toBe("__proto__");
  });
});

describe("multiple named questions in one request", () => {
  const questions = {
    approved: { type: "boolean" as const, instructions: "Does the input request approval?" },
    refund: { type: "noul" as const, instructions: "Does the input request a refund?" },
    request_type: { type: "choice" as const, instructions: "Classify the request", criteria: { refund: "Refund requested", other: "Other request" } },
    urgency: { type: "score" as const, instructions: "Rate urgency", criteria: ["Low", "Medium", "High"] },
  };
  const answers = { approved: { type: "choice", choice: "false" }, refund: { type: "noul", noul: 0.98 }, request_type: { type: "choice", choice: "refund" }, urgency: { type: "score", score: 1.8 } };
  it.each(["gemini", "jev", "openrouter"] as const)("sends all question types once to %s and returns each result by name", async provider => {
    const { requestDecisions } = await import("./decision.js");
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers })));
    const results = await requestDecisions("Refund this today", questions, { provider, apiKey: "key", fetchImpl: request });
    expect(results).toEqual({ approved: false, refund: 0.98, request_type: "refund", urgency: 1.8 });
    expect(request).toHaveBeenCalledOnce();
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(Object.keys(body.questions)).toEqual(Object.keys(questions));
    expect(body.questions.refund.type).toBe("noul");
    expect(body.questions.urgency.type).toBe("score");
    expect(body.questions.request_type.type).toBe("choice");
  });
  it.each([undefined, { type: "noul", noul: 1.1 }, { type: "noul", noul: -0.1 }, { type: "noul", noul: "0.9" }, { type: "choice", choice: "true" }])("rejects the complete batch when one answer is missing or malformed (%j)", async refund => {
    const { requestDecisions } = await import("./decision.js");
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { ...answers, refund } })));
    await expect(requestDecisions("Input", questions, { provider: "gemini", apiKey: "key", fetchImpl: request })).rejects.toThrow();
  });
  it.each([{}, [], null, { q: { type: "score", instructions: "", criteria: ["Low", "High"] } }, { q: { type: "unsupported", instructions: "Question" } }])("rejects invalid question definitions before fetching (%j)", async raw => {
    const { requestDecisions, parseDecisionQuestions } = await import("./decision.js");
    const request = vi.fn<typeof fetch>();
    await expect(async () => requestDecisions("Input", parseDecisionQuestions(raw), { provider: "jev", apiKey: "key", fetchImpl: request })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
