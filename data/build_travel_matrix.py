"""Build a travel matrix; use haversine*1.3 at 25 km/h when OSMnx is unavailable."""
import math
def haversine_minutes(a, b):
    radius = 6371
    lat1, lon1 = a; lat2, lon2 = b
    dlat, dlon = math.radians(lat2-lat1), math.radians(lon2-lon1)
    x = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return (2*radius*math.asin(math.sqrt(x))*1.3/25)*60
