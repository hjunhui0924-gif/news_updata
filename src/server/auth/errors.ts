// Shared by HTTP handlers and plain Node workers; keep request APIs out of this module.
export class AccessError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}
