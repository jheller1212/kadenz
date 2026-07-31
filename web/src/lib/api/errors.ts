// The two answers a route gives someone asking for a resource that is not
// theirs, and the one place they are constructed.
//
// 404 is the default, and not out of politeness. Almost every id in Kadenz is a
// uuid for a row that only one athlete has: "403 Forbidden" on it confirms that
// the row exists and that someone else owns it, which is information the caller
// did not have and has no business getting. "404" is true from the caller's
// point of view -- there is no such resource for them -- and reveals nothing.
//
// 403 is reserved for the case where the caller demonstrably knows the resource
// exists because it is not theirs to begin with, which nothing in the API does
// today. It is here so that the choice stays explicit rather than being made by
// whichever status a new route happens to copy.

export class HttpError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? status));
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }
}

/** The resource does not exist, or does not exist for this caller. */
export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, { error: message });
}

/** The caller is known, the resource is known to be someone else's. */
export function forbidden(message = "Forbidden"): HttpError {
  return new HttpError(403, { error: message });
}

/** The request itself is malformed. */
export function badRequest(
  message = "Invalid request",
  details?: unknown
): HttpError {
  return new HttpError(400, details === undefined ? { error: message } : { error: message, details });
}
