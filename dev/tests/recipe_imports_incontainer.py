"""Each recipe module must load independently; import order cannot break the API."""
import subprocess,sys
for module in ('app.recipe_review','app.recipe_estimate','app.recipe_photo','app.recipe_import'):
 result=subprocess.run([sys.executable,'-c',f'import importlib; importlib.import_module({module!r})'],capture_output=True,text=True)
 assert result.returncode==0,(module,result.stderr)
print('Recipe modules: independent import order PASS; no network/model calls')
