---
title: "Zubio Asset Browser"
description: "A tool for managing and organizing studio assets"
date: 2023-09-10T12:02:56-06:00
draft: false
weight: 100
tags: ["sql", "python", "qt", "maya"]
cover:
    image: "projects/asset-browser/asset-browser-beedee.png"
---

At Studio Zubio, we worked on a variety of productions for a large number of clients, along with developing our own IP. This meant that we had hundreds of thousands of files and assets scattered across a sprawling folder structure. We needed a way to organize and manage these assets, and thus the Asset Browser was born. While some commercial solutions existed, none of them met our needs exactly, so we decided to build our own.

Some of the specific needs on this project was an artist-friendly UI that could quickly search for and display assets matching a number of criteria, a way to easily add metadata to assets, and a way to quickly preview assets. We also wanted to be able to both manually and automatically add tags to assets for easy searching.

We also wanted to be able to integrate the tool into our existing pipeline, so we needed a way to easily export the data to a database and to be able to access the data from other applications.

## SQL Database

It was quickly obvious that something that would search the file system itself each time a search was performed would be far too slow, so we decided to build a database that would store all the metadata about the assets. We used SQLite, which is a lightweight SQL database that stores all the data in a single file. This made it easy to share the database across the studio, and it was also easy to back up. I put the database on our shared server so that everyone could access it, and built a simple Python API for basic CRUD operations.

Using SQLite meant I could easily add metadata to assets by adding columns to the database. I created a separate table for tags, and then created a many-to-many relationship between assets and tags. This meant that an asset could have multiple tags, and a tag could be applied to multiple assets. This was important because we wanted to be able to search for assets by tag.

## Crawling the file system

While the database was great for storing metadata, we still needed a way to get the metadata from the file system in the first place. I wrote a Python script that would crawl the file system and create entries in the database for each asset. It would also create thumbnails for each asset, which would be used for the preview. The script would also check if an asset already existed in the database, and if so, it would update the entry with any new metadata. This meant that we could run the script periodically to update the database with any new or updated assets.

## PySide GUI

I then created a GUI using [PySide](https://pypi.org/project/PySide2/), which is a Python wrapper for the Qt framework. I created a simple UI that would allow us to search for assets by name, tag, or any other metadata. I also created a way to preview assets, which would display the thumbnail and any metadata. I also created a way to add tags to assets, which would update the database.

![Asset Browser](/projects/asset-browser/asset-browser-beedee.png)

## Standalone Application

I then used the [fman Build System](https://build-system.fman.io/) to create a standalone application that could be run on any OS. This was important because we wanted to be able to access the Asset Browser from any computer in the studio, and we didn't want to have to install Python and all the dependencies on every computer.

![Asset Browser](/projects/asset-browser/asset-browser-windows.png)

## Maya Integration

In addition, I created a Maya plugin that would allow us to access the Asset Browser from within Maya. This meant that we could easily import assets into Maya without having to leave the application. I also created a custom Maya shelf that would allow us to quickly access the Asset Browser from within Maya.

![Asset Browser](/projects/asset-browser/asset-browser-maya.png)

Additionally, I wrote a script that would generate thumbnails for Maya files (.ma and .mb) and exported 3D models (.fbx, .obj). This meant that we could preview these assets in the Asset Browser, even when not running the browser within Maya. I did this by exporting a single frame playblast of the asset, and then using that as the thumbnail.

## User Feedback

One of the benefits of working in a small company is that I could get feedback from the artists directly. I would often sit down with the artists and watch them use the tool, and then ask them what they liked and what they didn't like. This allowed me to quickly iterate on the tool and make it as user-friendly as possible. Some of the improvements I made based on user feedback were:

- Opening assets in the default application when double-clicking on them
- Storing the window position and size, along with pane sizes and re-opening the window in the same position
- Adding wildcards and negation to the search

I also added a form to the application that when submitted would create a new GitHub issue. This allowed the artists to easily submit feedback and bug reports, and it also allowed me to keep track of all the feedback in one place.

## Results

The Asset Browser was a huge success, and it was used by all the artists at Studio Zubio. It allowed us to easily find assets, and it also allowed us to add metadata to assets, which made them easier to find. It also allowed us to easily add tags to assets, which made it even easier to find assets. It also allowed us to easily preview assets, which made it easier to find the right asset for the job. It was also a great learning experience for me as I learned a lot about databases, Python, and Qt, along with how to build a user-friendly application.
