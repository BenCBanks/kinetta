FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# runs as an ordinary user; /data (uploads) and /run/lankki (generated passwords) belong to it
RUN useradd --uid 1000 --create-home lankki && mkdir -p /data /run/lankki && chown lankki:lankki /data /run/lankki
COPY app ./app
ENV FIT_DATA=/data PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER lankki
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
LABEL org.opencontainers.image.title="Lankki" org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.description="Private fitness and food tracking for you and your people"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
