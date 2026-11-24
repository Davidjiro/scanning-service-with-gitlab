# apps/lambdas/  -  three Lambda functions (Python 3.13, ARM64)

Each folder holds one `handler.py` with a `main(event, context)` function. The CDK zips the folder
(no build step, `boto3` is already in the Lambda runtime).

| Function | Trigger | Reads / writes | Teaches |
|----------|---------|----------------|---------|
| `api_handler` | API Gateway (proxy integration) | DynamoDB put/get/query, SNS publish | proxy event/response format, SNS message attributes, GSI query, module-level clients for warm starts |
| `worker` | SQS event source mapping | Step Functions `StartExecution` | batches, **partial batch response** (`batchItemFailures`), DLQ behaviour |
| `validate` | Step Functions task | none | a pure function; the Choice state branches on its result |

## Handler contract cheat-sheet
```python
def main(event, context):   # "handler.main" in the CDK
    ...
    return {...}            # API Gateway proxy: {statusCode, headers, body}
```

## Environment variables injected by CDK
| Function | Variables |
|----------|-----------|
| `api_handler` | `TABLE_NAME`, `TOPIC_ARN` |
| `worker` | `STATE_MACHINE_ARN` |
| `validate` | none |

## Quick local test (validate has no dependencies)
```bash
cd lambdas/validate && python3 -c "import handler; print(handler.main({'item':'book','quantity':2}, None))"
```
