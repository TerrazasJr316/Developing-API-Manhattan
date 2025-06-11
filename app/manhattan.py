def manhattan_path(origin, destination):
    # Ruta simple en L (horizontal primero, luego vertical)
    path = [
        [origin[0], origin[1]],
        [destination[0], origin[1]],
        [destination[0], destination[1]],
    ]
    return path
