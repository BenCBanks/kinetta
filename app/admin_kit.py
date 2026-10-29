"""Private age and operator Kit permission; never changes the member's consent."""
import datetime as dt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, StrictBool, StrictInt
from . import ai_access, db
from .admin_actions import ActionIn, replay, complete
from .admin_auth import admin_user

router=APIRouter(prefix='/api/admin')


def account_status(person):
    """Build list/detail fields from the joined profile, without one query per account."""
    year=person.pop('birth_year')
    current=dt.datetime.now(dt.timezone.utc).year
    person['age']={'birth_year':year,'approximate_years':current-year if year is not None else None,'as_of_year':current}
    allowed=bool(person.pop('ai_access_allowed'))
    consent=bool(person.pop('ai_ok'))
    adult=bool(person.pop('ai_adult_confirmed'))
    by=person.pop('ai_adult_by')
    if not allowed: status,reason='blocked',ai_access.OPERATOR_BLOCK
    elif not ai_access.age_eligible(year): status,reason='under_age',ai_access.AGE_BLOCK
    elif not consent: status,reason='off','The member has not turned Kit on.'
    elif not adult: status,reason='needs_age','The member must confirm they are 18 or older.'
    else: status,reason='on',None
    person['kit']={'allowed':allowed,'consent':consent,'adult_confirmed':adult,'adult_confirmed_by':by,
                   'status':status,'reason':reason}
    return person


class KitSettingsIn(ActionIn):
    confirm: str=Field(max_length=30)
    birth_year: StrictInt | None=Field(ge=1920)
    allowed: StrictBool


@router.post('/people/{uid}/kit')
def change(uid:int,body:KitSettingsIn,user=Depends(admin_user)):
    if body.birth_year is not None and body.birth_year>dt.datetime.now(dt.timezone.utc).year:
        raise HTTPException(400,'Birth year cannot be in the future.')
    with db.connect() as c:
        digest,old=replay(c,user,body,'account.kit_settings',uid)
        if old:return old
        target=c.execute('SELECT login::text AS login FROM users WHERE id=%s FOR UPDATE',(uid,)).fetchone()
        if not target:raise HTTPException(404,'Account not found.')
        if body.confirm!=target['login']:raise HTTPException(400,'Type the account username exactly.')
        updated=c.execute('UPDATE profile SET birth_year=%s,ai_access_allowed=%s WHERE user_id=%s RETURNING user_id',
                          (body.birth_year,body.allowed,uid)).fetchone()
        if not updated:raise HTTPException(409,'This account has no profile. Reload before trying again.')
        return complete(c,user,body,'account.kit_settings',uid,digest)
