export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function denied(): never {
  throw new AppError(403, "FORBIDDEN", "Your role cannot perform this action.");
}
export function missing(): never {
  throw new AppError(404, "NOT_FOUND", "Record not found.");
}
export function conflict(): never {
  throw new AppError(
    409,
    "VERSION_CONFLICT",
    "This request changed. Refresh before trying again.",
  );
}
