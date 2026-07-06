from sqlalchemy import ColumnElement, func

from app.models import Event

EVENT_MATCH_RADIUS_KM = 50.0


def distance_km(latitude: float, longitude: float) -> ColumnElement[float]:
    """Haversine distance in km from the given point to Event's venue."""
    lat1, lon1 = func.radians(latitude), func.radians(longitude)
    lat2, lon2 = func.radians(Event.venue_latitude), func.radians(Event.venue_longitude)
    central_angle = 2 * func.asin(
        func.sqrt(
            func.power(func.sin((lat2 - lat1) / 2), 2)
            + func.cos(lat1) * func.cos(lat2) * func.power(func.sin((lon2 - lon1) / 2), 2)
        )
    )
    return 6371.0 * central_angle
