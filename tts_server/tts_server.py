import os
import io
import uuid
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from RealtimeTTS import TextToAudioStream, FasterQwenEngine, FasterQwenVoice

app = FastAPI(title="Faster Qwen TTS Server (OpenAI Compatible)")

voice_name = os.getenv("VOICE_NAME", "demo")
ref_audio = os.getenv("REF_AUDIO", "reference.wav")
ref_text = os.getenv("REF_TEXT", "This is a reference text.")

try:
    voice = FasterQwenVoice(
        name=voice_name,
        ref_audio=ref_audio,
        ref_text=ref_text,
        language="English"
    )
    engine = FasterQwenEngine(device="cuda", voice=voice)
    print("Faster Qwen TTS Engine initialized successfully on CUDA.")
except Exception as e:
    print(f"Error initializing Faster Qwen TTS Engine: {e}")
    # Fallback to system engine for testing if CUDA/Qwen fails
    from RealtimeTTS import SystemEngine
    engine = SystemEngine()

class TTSRequest(BaseModel):
    model: str
    input: str
    voice: Optional[str] = None
    response_format: Optional[str] = "wav"
    speed: Optional[float] = 1.0

@app.post("/v1/audio/speech")
async def generate_speech(request: TTSRequest):
    if not request.input.strip():
        raise HTTPException(status_code=400, detail="Input text is empty.")
    
    output_stream = io.BytesIO()
    try:
        tts_stream = TextToAudioStream(engine)
        tts_stream.feed(request.input)
        
        temp_wav = f"/tmp/{uuid.uuid4()}.wav"
        tts_stream.play(output_wavfile=temp_wav, muted=True)
        
        with open(temp_wav, "rb") as f:
            audio_bytes = f.read()
        
        os.remove(temp_wav)
        
        output_stream.write(audio_bytes)
        output_stream.seek(0)
        
        return StreamingResponse(
            output_stream,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=speech.wav"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
