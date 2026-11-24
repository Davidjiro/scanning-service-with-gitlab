#!/usr/bin/env bash
# Shared helpers for the operational scripts. Sourced, not executed.

# stack_output <stack-name> <output-key>  ->  prints the value of a CloudFormation output
stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text
}

# require <command>  ->  abort with a clear message if a tool is missing
require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' is not installed (see README prerequisites)." >&2; exit 1; }
}
