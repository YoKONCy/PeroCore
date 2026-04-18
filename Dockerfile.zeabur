FROM python:3.10-slim AS builder

RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    libssl-dev \
    pkg-config \
    git \
    clang \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add wasm32-unknown-unknown
RUN pip install --no-cache-dir maturin

WORKDIR /app

COPY Cargo.toml Cargo.toml
COPY backend/ backend/

RUN maturin build --release -m backend/nit_core/interpreter/rust_binding/Cargo.toml --out /tmp/wheels
RUN maturin build --release -m backend/vision_core/Cargo.toml --out /tmp/wheels
RUN cargo build --release --target wasm32-unknown-unknown \
    --manifest-path backend/nit_core/nit_terminal_auditor/Cargo.toml
RUN cargo build --release \
    --manifest-path backend/nit_core/tools/work/CodeSearcher/src/Cargo.toml

FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements-server.txt ./requirements-server.txt
RUN pip install --no-cache-dir -r requirements-server.txt

COPY --from=builder /tmp/wheels/*.whl /tmp/wheels/
RUN pip install --no-cache-dir /tmp/wheels/*.whl && rm -rf /tmp/wheels

COPY --from=builder /app/target/wasm32-unknown-unknown/release/nit_terminal_auditor.wasm \
    /app/backend/nit_core/tools/work/TerminalExecutor/auditor.wasm
COPY --from=builder /app/target/release/CodeSearcher \
    /app/backend/nit_core/tools/work/CodeSearcher/CodeSearcher
RUN chmod +x /app/backend/nit_core/tools/work/CodeSearcher/CodeSearcher

COPY backend/ /app/backend/

ENV PERO_ENV=server
ENV PORT=8080
ENV PERO_DATA_DIR=/data
ENV PERO_DATABASE_PATH=/data/perocore.db
ENV PYTHONPATH=/app

EXPOSE 8080

CMD ["python", "backend/main.py"]
