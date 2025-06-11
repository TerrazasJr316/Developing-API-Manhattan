const map = L.map("map").setView([19.4326, -99.1332], 13); // Ciudad de México

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
}).addTo(map);

let points = [];
let markers = [];

map.on("click", function (e) {
    if (points.length >= 2) {
        points = [];
        markers.forEach(m => map.removeLayer(m));
        markers = [];
    }

    const latlng = [e.latlng.lat, e.latlng.lng];
    points.push(latlng);

    const marker = L.marker(latlng).addTo(map);
    markers.push(marker);

    if (points.length === 2) {
        fetch("/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                origin: points[0],
                destination: points[1],
                method: document.getElementById("method").value
            })
        })
        .then(res => res.json())
        .then(data => {
            L.polyline(data.path, { color: "red" }).addTo(map);
        });
    }
});
