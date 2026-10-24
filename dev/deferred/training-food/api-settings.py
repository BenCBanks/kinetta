class TrainingFoodIn(BaseModel):
    model_config={'extra':'forbid'}
    enabled:StrictBool | None
    adult_confirmed:StrictBool | None=None


@router.get('/training-days')
def training_days(user=Depends(current_user)):
    from . import training_food
    with db.connect() as c:
        ctx=energy.context(c,user['id'])
        return energy.day_goal(c,user['id'],ctx['today'],ctx=ctx)['training']


@router.put('/training-days')
def training_days_save(body:TrainingFoodIn,user=Depends(current_user)):
    from . import training_food
    with db.connect() as c:
        p=c.execute('SELECT birth_year,tz,training_food_adult_confirmed FROM profile WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone() or {}
        year=c.execute('SELECT extract(year FROM now() AT TIME ZONE %s)::int AS y',(p.get('tz') or db.DEFAULT_TZ,)).fetchone()['y']
        if body.adult_confirmed and p.get('birth_year') and year-p['birth_year']<18:raise HTTPException(400,'Training food guidance is for adults 18 and older')
        candidate={**p,**({'training_food_adult_confirmed':body.adult_confirmed} if body.adult_confirmed is not None else {})}
        if body.enabled is True and not training_food.policy(candidate,year,True,True)['adult']:raise HTTPException(400,'Confirm you are 18 or older before enabling training-day targets')
        c.execute('UPDATE profile SET training_day_targets=%s WHERE user_id=%s',(body.enabled,user['id']))
        if body.adult_confirmed is not None:c.execute('UPDATE profile SET training_food_adult_confirmed=%s WHERE user_id=%s',(body.adult_confirmed,user['id']))
    return {'ok':True}