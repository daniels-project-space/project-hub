/**
 * Value-blind boundaries for the credential vault.
 *
 * Identifiers are deliberately normalized before comparison so cosmetic
 * casing, Unicode compatibility forms, and separators cannot create a second
 * spelling of a forbidden namespace. Credential values are never inspected.
 */
export function normalizeVaultIdentifier(identifier: string): string {
  return identifier.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isOpenAiNamespace(identifier: string): boolean {
  const normalized = normalizeVaultIdentifier(identifier);
  return normalized.includes("openai") || normalized.includes("chatgpt");
}

export function assertAllowedVaultService(service: string): void {
  if (isOpenAiNamespace(service)) {
    throw new Error("OpenAI credential namespaces are not permitted");
  }
}

export function assertAllowedSecretReference(reference: {
  service: string;
  keyName?: string;
  aliases?: string[];
}): void {
  assertAllowedVaultService(reference.service);
  if (
    (reference.keyName !== undefined && isOpenAiNamespace(reference.keyName)) ||
    reference.aliases?.some(isOpenAiNamespace)
  ) {
    throw new Error("OpenAI credential namespaces are not permitted");
  }
}

/** Client capabilities must name one concrete, non-OpenAI service. */
export function assertAllowedClientServicePolicy(service: string): void {
  if (service.includes("*")) {
    throw new Error("Wildcard vault service policies are not permitted");
  }
  assertAllowedVaultService(service);
}
