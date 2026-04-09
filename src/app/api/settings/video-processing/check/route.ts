import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { isFfmpegAvailable, isWhisperAvailable, isTranscriptProviderAvailable } from "@/lib/video-processing";

export const GET = withUserAuth(async () => {
  return NextResponse.json({
    ffmpeg: isFfmpegAvailable(),
    whisper: isWhisperAvailable(),
    openai: isTranscriptProviderAvailable("openai"),
    gemini: isTranscriptProviderAvailable("gemini"),
  });
});
