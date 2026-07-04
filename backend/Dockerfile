FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
