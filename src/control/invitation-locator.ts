const MAX_INVITATION_LOCATOR_BYTES = 134;

/** Wire syntax only: Relay owns vocabulary, phrase construction and authority. */
export function isReadableInvitationLocator(value: string): boolean {
  return value.length <= MAX_INVITATION_LOCATOR_BYTES && /^[a-z]{3,24}(?:-[a-z]{3,24}){1,14}$/.test(value);
}
