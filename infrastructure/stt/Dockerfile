# Deedwell streaming STT: Vosk small English model (~300MB RAM), open source.
FROM python:3.11-slim
RUN pip install --no-cache-dir vosk==0.3.45 websockets==12.0 && \
    apt-get update && apt-get install -y --no-install-recommends wget unzip && \
    wget -q https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip && \
    unzip -q vosk-model-small-en-us-0.15.zip -d /model && rm vosk-model-small-en-us-0.15.zip && \
    apt-get purge -y wget unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY server.py /server.py
EXPOSE 2700
CMD ["python", "/server.py"]
