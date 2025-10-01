# booking

## Socket.IO Events

### booking_accept (extended driver details)
Payload:
```
{
  "bookingId": "<id>",
  "status": "accepted",
  "driver": {
    "id": "<ObjectId>",
    "name": "John Doe",
    "phone": "+251900000000",
    "carName": "Toyota Vitz",
    "vehicleType": "Sedan",
    "rating": 4.8,
    "carPlate": "AB-12345"
  }
}
```

Notes: carName/vehicleType/rating/carPlate are read from the `Driver` model; if missing, they are populated from the authenticated driver's token claims.

### driver:init_bookings (initial driver bookings on connect)
Emitted once to the driver socket immediately after connection.

Payload:
```
{
  "driverId": "<ObjectId>",
  "bookings": [
    {
      "bookingId": "<ObjectId>",
      "status": "pending",
      "pickup": "Bole Airport",
      "dropoff": "CMC",
      "fare": 350,
      "passenger": {
        "id": "<ObjectId>",
        "name": "Jane Doe",
        "phone": "+251911111111"
      }
    }
  ]
}
```
