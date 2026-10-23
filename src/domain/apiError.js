export class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}
