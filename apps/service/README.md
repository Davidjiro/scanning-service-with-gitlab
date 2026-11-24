# apps/service/  -  the container

One FastAPI app, one Dockerfile, **four runtime roles** chosen by environment variables:

| Where | `ROLE` | `PLATFORM` | Special env |
|-------|--------|-----------|-------------|
| ECS service `web` (public ALB) | `web` | `ecs` | `TABLE_NAME` |
| ECS service `internal` (private ALB) | `internal` | `ecs` | `TABLE_NAME` |
| EKS pod `peering-client` | `eks-client-peering` | `eks` | `UPSTREAM_URL=http://internal.<env>.orderflow.internal` |
| EKS pod `lattice-client` | `eks-client-lattice` | `eks` | `UPSTREAM_URL=http://<lattice-dns>` |

## Endpoints
| Path | Purpose |
|------|---------|
| `GET /health` | target group health check and Kubernetes probes (must return HTTP 200) |
| `GET /whoami` | returns role, platform, hostname: shows WHICH container answered |
| `GET /orders` | first 10 orders from DynamoDB (needs the ECS task role) |
| `GET /peer-check` | calls `$UPSTREAM_URL/whoami`, reports latency: the connectivity test |

## Image facts
- Base `python:3.13-slim`, built for **linux/arm64** (Graviton) by the CDK (`Platform.LINUX_ARM64`).
- Runs as **non-root** (uid 10001), listens on **8080**.
- Dependencies pinned in `requirements.txt`.

## Try locally
```bash
docker build --platform linux/arm64 -t orderflow-service .
docker run --rm -p 8080:8080 -e ROLE=web -e PLATFORM=local orderflow-service
curl localhost:8080/whoami
```
