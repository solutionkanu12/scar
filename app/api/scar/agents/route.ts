import { withScarApi } from "../runtime";

export async function POST(request: Request) {
  return withScarApi((api) => api.registerAgent(request));
}
