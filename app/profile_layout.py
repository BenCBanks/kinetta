"""Fixed presentation choices for shared profiles; activity audiences remain authoritative."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

SECTIONS=['recent','mileage','totals','sports','activities']
STATS=['activities','distance','time']


class ProfileLayout(BaseModel):
    model_config=ConfigDict(extra='forbid')
    sections:list[Literal['recent','mileage','totals','sports','activities']]=Field(default_factory=lambda:SECTIONS.copy(),max_length=5)
    stats:list[Literal['activities','distance','time','active_days']]=Field(default_factory=lambda:STATS.copy(),min_length=1,max_length=3)
    sports:list[Literal['run','ride','walk','hike','swim','workout','row','ski','other']]=Field(default_factory=list,max_length=3)

    @field_validator('sections','stats','sports')
    @classmethod
    def unique(cls,value):
        if len(value)!=len(set(value)):raise ValueError('Choose each item once.')
        return value


def normalize(value):
    try:return ProfileLayout.model_validate(value if isinstance(value,dict) else {}).model_dump()
    except ValidationError:return ProfileLayout().model_dump()
