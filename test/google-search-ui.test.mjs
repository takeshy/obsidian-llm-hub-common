import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoogleSearchSuggestions, GroundingAutoSaveNotice } from "../dist/ui/GoogleSearchSuggestions.js";

test("Google display HTML remains intact in a full-width sandbox without script permissions", () => {
  const html = '<style>.google{color:#123456}</style><a href="https://www.google.com/search?q=test">Search</a>';
  const element = GoogleSearchSuggestions;
  const rendered = renderToStaticMarkup(React.createElement(element, { html }));
  assert.match(rendered, /sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(rendered, /allow-scripts/);
  assert.match(rendered, /&lt;style&gt;.google\{color:#123456\}&lt;\/style&gt;/);
  assert.match(rendered, /&lt;base target=&quot;_blank&quot;&gt;/);
});
test("the persistent notice has no dismiss control", () => {
  const rendered = renderToStaticMarkup(React.createElement(GroundingAutoSaveNotice));
  assert.match(rendered, /This conversation is not saved automatically/);
  assert.doesNotMatch(rendered, /<button/);
});
