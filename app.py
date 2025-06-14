from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    # El destino se maneja en el frontend, así que podemos simplificar aquí.
    # Opcionalmente, podrías pasar valores por defecto si lo deseas.
    return render_template('index.html')

# El siguiente bloque se elimina o comenta, ya que Gunicorn se encargará de iniciar la app.
# if __name__ == '__main__':
#     app.run(debug=True, port=5001)