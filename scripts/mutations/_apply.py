def apply(path, code):
    import sys
    sys.argv = ['mutate', path]
    exec(compile(code, 'mutation', 'exec'), {'__name__':'__main__','sys':sys})
