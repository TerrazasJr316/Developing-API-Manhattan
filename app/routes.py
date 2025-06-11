from flask import Blueprint, render_template, request, jsonify
from .manhattan import manhattan_path
from .dijkstra import get_dijkstra_route

main = Blueprint("main", __name__)

@main.route("/", methods=["GET", "POST"])
def index():
    return render_template("index.html")

@main.route("/route", methods=["POST"])
def route():
    data = request.json
    origin = data["origin"]
    destination = data["destination"]
    method = data["method"]

    if method == "manhattan":
        path = manhattan_path(origin, destination)
    elif method == "dijkstra":
        path = get_dijkstra_route(origin, destination)
    else:
        return jsonify({"error": "Método inválido"}), 400

    return jsonify({"path": path})
