"""Minimal Vosk streaming ASR websocket server (small model, low memory).
Protocol: optional {"config":{...}} text frame, then 16kHz PCM16 binary frames;
replies {"partial": "..."} and finals {"text": "..."} — vosk-server compatible.
"""
import asyncio, json
import websockets
from vosk import Model, KaldiRecognizer

model = Model("/model/vosk-model-small-en-us-0.15")

async def handle(ws):
    rec = KaldiRecognizer(model, 16000.0)
    async for msg in ws:
        if isinstance(msg, bytes):
            if rec.AcceptWaveform(msg):
                await ws.send(rec.Result())
            else:
                await ws.send(rec.PartialResult())
        else:
            try:
                if json.loads(msg).get("eof"):
                    await ws.send(rec.FinalResult())
            except Exception:
                pass  # config frames accepted silently

async def main():
    async with websockets.serve(handle, "0.0.0.0", 2700, max_size=2**20):
        await asyncio.Future()

asyncio.run(main())
