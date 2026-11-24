# apps/  -  the Python code the compute resources run

Deliberately small, so the behaviour of the infrastructure is easy to observe. Everything is plain Python.

| Folder | Runs on | What it does |
|--------|---------|--------------|
| `service/` | ECS Fargate (x2) and EKS (x2 pods) | FastAPI app: `/health`, `/whoami`, `/orders`, `/peer-check` |
| `lambdas/api_handler/` | Lambda behind API Gateway | create/read orders, publish `order.created` to SNS |
| `lambdas/worker/` | Lambda, triggered by SQS | starts a Step Functions execution per message |
| `lambdas/validate/` | Lambda, called by Step Functions | validates an order (item present, quantity 1-100) |
| `eks/` | Kubernetes | `deployment.yaml` for the two test pods |

## Request flow
```
POST /orders ─► API Gateway ─► api_handler ─► DynamoDB (NEW) + SNS(event_type=order.created)
                                                   │
                       SNS filter ─► SQS ─► worker ─► Step Functions ─► validate
                                                          ├─ valid:   DynamoDB PROCESSED, S3 receipt, SNS order.processed
                                                          └─ invalid: DynamoDB REJECTED
```

## Run things locally
```bash
# The FastAPI service (no AWS needed for /health and /whoami)
cd service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
ROLE=local PLATFORM=laptop uvicorn app.main:app --port 8080
curl localhost:8080/whoami

# The validation logic needs nothing but Python:
python3 -c "import sys; sys.path.insert(0,'lambdas/validate'); import handler; print(handler.main({'item':'x','quantity':3}, None))"
```
