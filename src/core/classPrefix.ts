/**
 * Class names in shared markup carry the host's prefix, matching the stylesheet this package ships
 * (which is expanded per host at build time). A host declares its prefix once, at load.
 */
let prefix = "chat-ui";

export function configureClassPrefix(hostPrefix: string): void {
  prefix = hostPrefix;
}

export function getClassPrefix(): string {
  return prefix;
}

/** Prefixed class names for imperative DOM: cls("workflow-value-textarea", "is-wide"). */
export function cls(...names: string[]): string {
  return names.map((name) => `${prefix}-${name}`).join(" ");
}
