"""Fixes from the final review: parser, calendar weeks, unfriending ends dish shares."""
from kc import ALEX, login


def person(name, pw):
    c = login(name, pw)
    def q(m, p, b=None, want=200):
        code, data = c.req(m, p, b if b is not None else ({} if m != 'GET' else None))
        assert code == want, (m, p, code, str(data)[:200])
        return data
    return q


a = person(*ALEX); j = person('jordan', 'demo friend password 1')      # dev/screenshots/stage.py
n=0
def ck(c,m):
    global n; assert c,m; n+=1
# parser
ck(a('POST','/api/dishes/parse',{'text':'1 1/0 cup rice'})['grams'] is None, 'zero fraction ok')
# calendar
ck(len(a('GET','/api/calendar/month?month=2026-05')['days'])==35, 'May 2026 = 5 weeks')
ck(len(a('GET','/api/calendar/month?month=2027-02')['days'])==28, 'Feb 2027 = 4 weeks')
ck(a('GET','/api/calendar/month?month=2026-11')['days'][-1]['d']=='2026-12-06', 'Nov 2026 ends Sun Dec 6')
a('GET','/api/calendar/month?month=9999-12',want=400); a('GET','/api/calendar/month?month=0001-01',want=400); n+=2
# portions back to leftovers
d=a('POST','/api/dishes',{'name':'Test stew'}); did=d['id']
a('POST',f'/api/dishes/{did}/items',{'name':'Beans','grams':1000,'per100':{'kcal':100}}); a('PATCH',f'/api/dishes/{did}',{'cooked_g':1000})
r=a('POST',f'/api/dishes/{did}/portion',{'grams':300,'meal':'dinner'}); eid=r['entry']['id']; ck(r['entry']['kcal']==300,'portion logged')
dl=a('DELETE',f'/api/food/entries/{eid}')['deleted']
a('POST','/api/food/entries',[{k:dl[k] for k in ('day','meal','name','amount','unit','kcal','protein_g','carbs_g','fat_g','source','ref') if dl.get(k) is not None}])
ck(a('GET',f'/api/dishes/{did}')['weight_g']==1000,'undo of a deleted portion leaves the dish as it was')
ck(a('GET',f'/api/dishes/{did}')['review'] is None,'no review yet')
# unfriend ends sharing
a('POST',f'/api/dishes/{did}/share',{'login':'jordan'}); ck(j('GET',f'/api/dishes/{did}')['mine'] is False,'shared')
j('DELETE','/api/friends/alex'); j('GET',f'/api/dishes/{did}',want=404); n+=1
ck(all(x['id']!=did for x in j('GET','/api/dishes')),'gone from list')
j('POST','/api/friends',{'login':'alex'}); a('POST','/api/friends/jordan/accept')
j('GET',f'/api/dishes/{did}',want=404); n+=1     # share was removed, not just hidden
a('DELETE',f'/api/dishes/{did}')
print(f'review fixes: {n} checks passed')
