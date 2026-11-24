"""
Lambda: worker  (consumer of the SQS queue)

SQS -> Lambda uses an *event source mapping*: Lambda polls the queue FOR YOU and invokes this
function with a batch of messages in event["Records"].

PARTIAL BATCH RESPONSE: if 1 of 5 messages fails we return only that message id in
`batchItemFailures`. The other 4 are deleted, the failed one becomes visible again and, after
`maxReceiveCount` attempts, lands in the Dead Letter Queue. Without this, ONE bad message would
make the whole batch retry.
"""
import os

import boto3

_sfn = boto3.client("stepfunctions")
_state_machine_arn = os.environ["STATE_MACHINE_ARN"]


def main(event: dict, context) -> dict:
    failures = []
    for record in event["Records"]:
        try:
            # SNS raw message delivery => body is exactly the JSON the API Lambda published.
            _sfn.start_execution(stateMachineArn=_state_machine_arn, input=record["body"])
        except Exception as err:  # noqa: BLE001 - any failure is reported back to SQS
            print(f"failed message {record['messageId']}: {err}")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
