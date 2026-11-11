/** Keep the receipt key across ambiguous failures; changed payloads are new attempts. */
export function createSubmissionTracker(uuid: () => string = () => crypto.randomUUID()) {
  let pending: { payload: string; id: string } | undefined;
  return {
    forPayload(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (pending?.payload !== serialized) pending = { payload: serialized, id: uuid() };
      return pending.id;
    },
    clear() {
      pending = undefined;
    },
  };
}
