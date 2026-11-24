"""
Lambda: api-handler  (behind API Gateway REST API, Lambda *proxy* integration)

Routes:
  POST /orders            create an order  -> DynamoDB (status NEW) + SNS "order.created"
  GET  /orders/{orderId}  fetch one order
  GET  /orders?status=NEW list orders by status (uses the by-status GSI)

Proxy integration = API Gateway passes the whole HTTP request in `event` and expects
{statusCode, headers, body} back. Notice we create boto3 clients OUTSIDE the handler:
Lambda reuses the execution environment between invocations ("warm start"), so we skip
re-creating them every time.
"""
import json
import os
import time
import uuid

import boto3
from boto3.dynamodb.conditions import Key

_dynamodb = boto3.resource("dynamodb")
_sns = boto3.client("sns")
_table = _dynamodb.Table(os.environ["TABLE_NAME"])
_topic_arn = os.environ["TOPIC_ARN"]


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def _create_order(event: dict) -> dict:
    body = json.loads(event.get("body") or "{}")
    order = {
        "orderId": str(uuid.uuid4()),
        "item": body["item"],
        "quantity": int(body["quantity"]),
        "status": "NEW",
        "createdAt": int(time.time()),
    }
    _table.put_item(Item=order)
    # The *message attribute* event_type is what the SNS subscription filter policy looks at.
    _sns.publish(
        TopicArn=_topic_arn,
        Message=json.dumps(order),
        MessageAttributes={"event_type": {"DataType": "String", "StringValue": "order.created"}},
    )
    return _response(201, order)


def _get_order(order_id: str) -> dict:
    item = _table.get_item(Key={"orderId": order_id}).get("Item")
    return _response(200, item) if item else _response(404, {"message": "order not found"})


def _list_by_status(status: str) -> dict:
    result = _table.query(
        IndexName="by-status",
        KeyConditionExpression=Key("status").eq(status),
        ScanIndexForward=False,  # newest first (sort key = createdAt)
        Limit=25,
    )
    return _response(200, {"items": result["Items"]})


def main(event: dict, context) -> dict:
    method, path = event["httpMethod"], event["path"]
    try:
        if method == "POST" and path == "/orders":
            return _create_order(event)
        if method == "GET" and (event.get("pathParameters") or {}).get("orderId"):
            return _get_order(event["pathParameters"]["orderId"])
        if method == "GET" and path == "/orders":
            status = (event.get("queryStringParameters") or {}).get("status", "NEW")
            return _list_by_status(status)
        return _response(404, {"message": "not found"})
    except (KeyError, ValueError, json.JSONDecodeError) as err:
        return _response(400, {"message": f"bad request: {err}"})
