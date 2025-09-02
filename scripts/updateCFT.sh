#!/bin/bash
STACK_NAME="pyre"
TEMPLATE_FILE="./infra/cft.yml"
PARAMETERS_FILE="./infra/parameters.json"
CAPABILITIES="CAPABILITY_NAMED_IAM"

# Attempt to create the stack
echo "Attempting to create the stack..."
aws cloudformation create-stack \
    --stack-name $STACK_NAME \
    --template-body file://$TEMPLATE_FILE \
    --parameters file://$PARAMETERS_FILE \
    --capabilities $CAPABILITIES

# Check the result of the create-stack command
if [ $? -eq 0 ]; then
    echo "Stack creation initiated successfully."
else
    echo "Stack creation failed or stack already exists. Attempting to update the stack..."
    
    # Attempt to update the stack
    aws cloudformation update-stack \
        --stack-name $STACK_NAME \
        --template-body file://$TEMPLATE_FILE \
        --parameters file://$PARAMETERS_FILE \
        --capabilities $CAPABILITIES

    # Check the result of the update-stack command
    if [ $? -eq 0 ]; then
        echo "Stack update initiated successfully."
    else
        echo "Stack update failed. Please check for errors."
    fi
fi

aws s3 sync ./dist s3://pyresauna.com --delete

aws cloudfront create-invalidation --distribution-id E1D95O9W7YDX1X --paths "/*"

