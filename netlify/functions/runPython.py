import json

def handler(event, context):
    # Example Python function
    data = json.loads(event['body'])
    result = my_python_function(data['input'])
    return {
        'statusCode': 200,
        'body': json.dumps({'result': result})
    }

def my_python_function(input_value):
    # Replace this with your actual Python function
    return input_value * 2