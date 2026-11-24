"""
Lambda: validate  (first task of the Step Functions state machine)

Input : {"orderId": "...", "item": "...", "quantity": 3, ...}
Output: {"valid": true|false, "reason": "..."}

The state machine's Choice state branches on `$.validation.valid`.
Business rule (deliberately trivial): item must be non-empty, quantity between 1 and 100.
"""


def main(event: dict, context) -> dict:
    item = str(event.get("item", "")).strip()
    quantity = event.get("quantity", 0)
    if not item:
        return {"valid": False, "reason": "item is empty"}
    if not isinstance(quantity, int) or not 1 <= quantity <= 100:
        return {"valid": False, "reason": "quantity must be an integer from 1 to 100"}
    return {"valid": True, "reason": "ok"}
