"""
Small FastAPI service. The SAME container image runs on:
  - ECS Fargate  (ROLE=web and ROLE=internal, PLATFORM=ecs)
  - EKS pods     (ROLE=eks-client,              PLATFORM=eks)
Behaviour is selected only by environment variables (12-factor style).

Endpoints
  GET /health      load balancer / Kubernetes probe target
  GET /whoami      who am I? (role, platform, host)  -> proves WHICH network path answered
  GET /orders      first 10 orders from DynamoDB (needs an IAM role; ECS tasks have one)
  GET /peer-check  call $UPSTREAM_URL/whoami and report the result (connectivity test)
"""
import json
import os
import socket
import time
import urllib.request

from fastapi import FastAPI, HTTPException

app = FastAPI(title="orderflow-service")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/whoami")
def whoami() -> dict:
    return {
        "role": os.getenv("ROLE", "unknown"),
        "platform": os.getenv("PLATFORM", "unknown"),
        "hostname": socket.gethostname(),
        "environment": os.getenv("ENV_NAME", "unknown"),
    }


@app.get("/orders")
def orders() -> dict:
    table_name = os.getenv("TABLE_NAME")
    if not table_name:
        raise HTTPException(status_code=503, detail="TABLE_NAME not set (no DynamoDB access on this runtime)")
    import boto3  # imported lazily so /health stays fast and works without AWS credentials

    items = boto3.resource("dynamodb").Table(table_name).scan(Limit=10).get("Items", [])
    return {"count": len(items), "items": items}


@app.get("/peer-check")
def peer_check() -> dict:
    upstream = os.getenv("UPSTREAM_URL")
    if not upstream:
        raise HTTPException(status_code=503, detail="UPSTREAM_URL not set")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(f"{upstream.rstrip('/')}/whoami", timeout=3) as resp:  # noqa: S310
            body = json.loads(resp.read())
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"cannot reach {upstream}: {err}") from err
    return {
        "upstream": upstream,
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "upstream_answer": body,
    }
