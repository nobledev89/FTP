import { revalidateTag } from "next/cache";

import { PUBLIC_ARTICLES_TAG, publicArticleTag } from "@/lib/publication/repository";
import { authenticateRevalidationRequest } from "@/lib/publication/revalidation";

export const dynamic = "force-dynamic";

function json(body: object, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return json({ revalidated: false, message: "Revalidation is not configured" }, 503);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 1024) {
    return json({ revalidated: false, message: "Request body is too large" }, 413);
  }

  const body = await request.text();
  const authentication = authenticateRevalidationRequest({
    secret,
    timestamp: request.headers.get("x-fintechpulse-timestamp"),
    nonce: request.headers.get("x-fintechpulse-nonce"),
    signature: request.headers.get("x-fintechpulse-signature"),
    body,
  });
  if (!authentication.ok) {
    return json({ revalidated: false, message: authentication.message }, authentication.status);
  }

  revalidateTag(PUBLIC_ARTICLES_TAG, { expire: 0 });
  revalidateTag(publicArticleTag(authentication.request.slug), { expire: 0 });
  return json(
    {
      revalidated: true,
      slug: authentication.request.slug,
      now: new Date().toISOString(),
    },
    200,
  );
}
