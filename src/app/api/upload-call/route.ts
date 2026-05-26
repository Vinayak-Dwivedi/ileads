import { NextResponse } from "next/server";
import { uploadToS3 } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("audio");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required under the 'audio' field." },
        { status: 400 },
      );
    }

    // Convert the File to a Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name;
    const contentType = file.type || "audio/mpeg";

    // Upload to S3 using the helper function
    const result = await uploadToS3(buffer, fileName, contentType);

    return NextResponse.json({
      success: true,
      key: result.key,
      url: result.url,
    });
  } catch (error) {
    console.error("S3 Upload API Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
