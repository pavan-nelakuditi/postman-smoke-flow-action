export class ValidationError extends Error {}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }

  static async fromResponse(response: Response, url: string, method: string): Promise<HttpError> {
    const body = await response.text();
    return new HttpError(`${method} ${url} failed: ${response.status} ${body}`, response.status);
  }
}
