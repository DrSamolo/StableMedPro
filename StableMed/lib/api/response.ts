import { NextResponse } from "next/server";

import { ApiError } from "./errors";

export function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function jsonOk<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      request_id: requestId,
      data,
    },
    {
      status,
      headers: {
        "x-request-id": requestId,
      },
    },
  );
}

export function jsonError(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        request_id: requestId,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      {
        status: error.status,
        headers: {
          "x-request-id": requestId,
        },
      },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      request_id: requestId,
      error: {
        code: "INTERNAL_ERROR",
        message: "Une erreur interne est survenue",
      },
    },
    {
      status: 500,
      headers: {
        "x-request-id": requestId,
      },
    },
  );
}
