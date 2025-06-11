import osmnx as ox
import networkx as nx

def get_dijkstra_route(origin, destination):
    lat1, lon1 = origin
    lat2, lon2 = destination

    # Descargar grafo alrededor del punto medio
    mid_lat = (lat1 + lat2) / 2
    mid_lon = (lon1 + lon2) / 2
    G = ox.graph_from_point((mid_lat, mid_lon), dist=1000, network_type="walk")

    orig_node = ox.distance.nearest_nodes(G, lon1, lat1)
    dest_node = ox.distance.nearest_nodes(G, lon2, lat2)

    route = nx.shortest_path(G, orig_node, dest_node, weight="length")
    route_coords = [[G.nodes[node]["y"], G.nodes[node]["x"]] for node in route]

    return route_coords
