"""Independent food-thread request models; storage and workers import these safely."""
from pydantic import Field,StrictBool,ConfigDict,field_validator
from . import food_photo


class ResolveIn(food_photo.PhotoIn):
    model_config=ConfigDict(extra='forbid')
    note: str | None = Field(None,max_length=4000)
    retry: StrictBool=False
    allow_brand_estimate: StrictBool=False
    part: int | None = Field(None,ge=0,lt=100)


    @field_validator('images')
    @classmethod
    def bounded_images(cls,values):
        if any(len(value)>6_000_000 for value in values):raise ValueError('Choose JPEG photos under 4 MB each')
        return values
