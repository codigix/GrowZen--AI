"""ChatGPT-style SEO content workflow, built into the existing article generator (services/articles.py).

    master_prompt.py  the one central master SEO content prompt (inputs + content rules), [company_clientname] resolution
    research.py       real research data: Google results through Serper, competitor page headings, Keyword Planner volumes
    stages.py         one prompt module per stage (/brainstorm-content-ideas ... /human), each returning structured output
    runner.py         runs a stage, keeps every stage result with the article, retries one failed stage

Nothing is imported here on purpose: articles.py imports master_prompt, and stages.py imports articles.py.
"""
