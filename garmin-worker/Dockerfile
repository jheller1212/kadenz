FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    GARTH_HOME=/data/garth

# Install dependencies first for layer caching
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Every module the app imports at runtime, plus the bundled taxonomy snapshot.
# Missing files here fail only at container start, not at build — keep in sync.
COPY main.py workouts.py taxonomy.py ./
COPY data ./data

EXPOSE 8080

CMD ["sh", "-c", "uv run --no-sync uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
