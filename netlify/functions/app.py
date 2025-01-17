from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/runPython', methods=['POST'])
def run_python():
    data = request.get_json()
    input_value = data['input']
    result = my_python_function(input_value)
    return jsonify({'result': result})

def my_python_function(input_value):
    # Replace this with your actual Python function
    return int(input_value) * 2

if __name__ == '__main__':
    app.run(debug=True)