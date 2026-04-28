import os
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException

load_dotenv()

app = FastAPI(title="Kadenz Garmin Worker")

WORKER_TOKEN = os.getenv("WORKER_TOKEN", "")


def verify_token(authorization: Annotated[str, Header()]) -> None:
    """Bearer token auth dependency."""
    if not WORKER_TOKEN:
        raise HTTPException(status_code=500, detail="WORKER_TOKEN not configured")
    expected = f"Bearer {WORKER_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


Auth = Annotated[None, Depends(verify_token)]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/workouts")
def create_workout(_auth: Auth):
    # TODO: Create and schedule a structured workout on Garmin Connect via garth
    raise NotImplementedError


@app.patch("/workouts/{workout_id}")
def move_workout(workout_id: str, _auth: Auth):
    # TODO: Move a scheduled workout to a new date
    raise NotImplementedError


@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: str, _auth: Auth):
    # TODO: Remove a scheduled workout from Garmin Connect
    raise NotImplementedError
