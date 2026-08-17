import { ApiError } from "./error";

export async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(res.status, "http_error", text.slice(0, 200));
      throw new ApiError(res.status, "invalid_response", "Response was not valid JSON");
    }
  }
  if (!res.ok) {
    const code = (json && typeof json === "object" && "error" in json) ? String((json as { error: unknown }).error) : "http_error";
    const message = (json && typeof json === "object" && "message" in json) ? String((json as { message: unknown }).message) : undefined;
    throw new ApiError(res.status, code, message);
  }
  return json as T;
}
