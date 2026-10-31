FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# runs as an ordinary user; /data (uploads) and /run/kinetta (generated passwords) belong to it
RUN useradd --uid 1000 --create-home kinetta && mkdir -p /data /run/kinetta && chown kinetta:kinetta /data /run/kinetta
COPY app ./app
RUN python -m app.asset_build app/static app/static
ENV FIT_DATA=/data PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER kinetta
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
LABEL org.opencontainers.image.title="Kinetta" org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.description="Private fitness and food tracking for you and your people"
# X-Forwarded-For is believed only from the proxies in FORWARDED_ALLOW_IPS (uvicorn's own setting; default 127.0.0.1).
# It used to be "*": anyone could claim any address and dodge the login-guessing limits (2026-10-12 review).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
